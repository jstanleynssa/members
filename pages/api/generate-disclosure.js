import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'

const MODEL = process.env.OPENAI_BIO_MODEL || 'gpt-4o-mini'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const supabaseServer = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Disclosure generation is not configured.' })

  const { first_name = '', last_name = '', company = '' } = req.body
  const name = `${first_name} ${last_name}`.trim() || 'The advisor'
  const org = company.trim()

  // Tightly constrained: convey ONLY the standard non-affiliation facts. The
  // model varies phrasing/structure (to avoid duplicate-content across profiles)
  // but must not add, soften, or invent any claim. This is a RECOMMENDED,
  // editable default — advisors with their own firm's required disclosure
  // should replace it.
  const systemMsg =
    'You write short, plain-English non-affiliation disclosures for financial ' +
    'advisor directory profiles. You convey ONLY these facts: the advisor and ' +
    'their company are not employed by, affiliated with, or endorsed by the ' +
    'Social Security Administration (SSA), Medicare, the Centers for Medicare & ' +
    'Medicaid Services (CMS), or the U.S. Department of Health and Human Services ' +
    '(HHS); and any information provided is for general educational purposes and ' +
    'is not official government information. Do NOT add legal, securities, or ' +
    'investment-advice language. Do NOT invent firm names, registrations, or ' +
    'claims. Vary the wording and sentence structure so no two disclosures read ' +
    'identically. Return only the disclosure text — 1 to 2 sentences, no heading, ' +
    'no markdown.'

  const userMsg =
`Write one non-affiliation disclosure.
Advisor name: ${name}
Company name: ${org || '(no company provided — refer only to the advisor)'}

Use the advisor's name and (if provided) company name naturally. Convey the non-affiliation facts with SSA, Medicare, CMS, and HHS, and that information is educational, not official government information. Keep it to 1–2 sentences.`

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.9, // higher → more phrasing variety across profiles
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      console.error(`[generate-disclosure] OpenAI ${resp.status}: ${errText}`)
      return res.status(502).json({ error: 'Could not generate a disclosure right now.' })
    }

    const data = await resp.json()
    let text = data?.choices?.[0]?.message?.content?.trim() || ''
    text = text.replace(/<[^>]+>/g, '').replace(/^["']|["']$/g, '').trim()
    if (!text) return res.status(502).json({ error: 'The generator returned an empty result.' })

    return res.status(200).json({ ok: true, disclosure: text })
  } catch (err) {
    console.error('[generate-disclosure] error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
