import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'

// Premium model by default; overridable via env without a code change in case
// the exact model string needs to be adjusted in the OpenAI account.
const BIO_MODEL = process.env.OPENAI_BIO_MODEL || 'gpt-5.5'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // Authenticate via session — a member can only generate their own bio.
  const supabaseServer = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Bio generation is not configured yet.' })

  // Grounding facts come from the wizard (already collected in earlier steps).
  // The talking-points box is the advisor's own voice; structured fields are
  // optional extras. We pull title/company/location for the SEO targeting.
  const {
    first_name = '', last_name = '', job_title = '', company = '',
    city = '', state = '',
    talking_points = '',   // the freeform "about you" box
    years_experience = '', // optional
    specialty = '',        // optional
  } = req.body

  const name = `${first_name} ${last_name}`.trim()
  if (!talking_points.trim() && !specialty.trim() && !years_experience.trim()) {
    return res.status(400).json({ error: 'Please add a few details about yourself first.' })
  }

  // ── Prompt — ports the proven Zapier "Create Profile Summary" prompt ──────
  // Key change vs. the original: returns PLAIN TEXT with blank lines between
  // paragraphs (NOT <p> tags), matching the plain-text bio standard.
  const locationPhrase = [city, state].filter(Boolean).join(', ')
  const facts = [
    name && `Name: ${name}`,
    job_title && `Job title: ${job_title}`,
    company && `Company: ${company}`,
    locationPhrase && `Location: ${locationPhrase}`,
    years_experience && `Years of experience: ${years_experience}`,
    specialty && `Areas of specialty/focus: ${specialty}`,
  ].filter(Boolean).join('\n')

  const seoTarget = [
    job_title ? `${job_title}s` : 'financial advisors',
    'and social security experts',
    locationPhrase ? `in ${locationPhrase}` : null,
  ].filter(Boolean).join(' ')

  const systemMsg =
    'You are an expert copywriter who writes persuasive, conversion-optimized ' +
    'professional profile summaries for financial advisors on the National ' +
    'Social Security Advisors directory (nssapros.com). You write only from the ' +
    'facts the advisor provides — never invent credentials, awards, years of ' +
    'experience, designations, or specific achievements that were not supplied. ' +
    'You may phrase and polish freely, but every factual claim must come from the input.'

  const userMsg =
`Write a conversion-optimized professional profile summary for ${name || 'this advisor'}, presenting them as a reliable, knowledgeable, and respected professional in their field.

Facts about the advisor:
${facts}

In the advisor's own words (talking points — professional history, approach, and personal facts such as hobbies or family; not polished, your job is to shape it):
${talking_points || '(none provided — work from the facts above)'}

Requirements:
- Optimize the summary to be found by people searching for "${seoTarget}".
- Persuasive and warm, but professional and credible — not hype.
- Naturally work in the advisor's location and specialty where it fits.
- Write 2 to 4 short paragraphs.
- Return ONLY the summary text itself. No headline, no labels, no markdown, no ** or ## formatting.
- Separate paragraphs with a single blank line. Do NOT use HTML tags of any kind.`

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: BIO_MODEL,
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.8,
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      console.error(`[generate-bio] OpenAI ${resp.status}: ${errText}`)
      // Surface a friendly message; the common cause is billing/quota.
      return res.status(502).json({ error: 'Could not generate the bio right now. Please try again, or write your own.' })
    }

    const data = await resp.json()
    let bio = data?.choices?.[0]?.message?.content?.trim() || ''
    // Defensive: strip any stray HTML the model might emit despite instructions,
    // and collapse 3+ newlines to a clean paragraph break.
    bio = bio.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim()
    if (!bio) return res.status(502).json({ error: 'The generator returned an empty result. Please try again.' })

    return res.status(200).json({ ok: true, bio })
  } catch (err) {
    console.error('[generate-bio] error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
