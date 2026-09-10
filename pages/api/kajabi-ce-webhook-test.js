import { createClient } from '@supabase/supabase-js'

// Test harness for /api/kajabi-ce-webhook
// POST { email, tag }               → simulates a Kajabi tag-applied webhook
// DELETE { submissionId }           → cleans up a test record

export default async function handler(req, res) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  if (req.method === 'DELETE') {
    const { submissionId } = req.body
    if (!submissionId) return res.status(400).json({ error: 'Missing submissionId' })
    const { error } = await supabase
      .from('ce_submissions')
      .delete()
      .eq('id', submissionId)
      .eq('source', 'kajabi_recording')
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, deleted: submissionId })
  }

  if (req.method !== 'POST') return res.status(405).end()

  const { email, tag } = req.body
  if (!email || !tag) return res.status(400).json({ error: 'Missing required fields: email, tag' })

  // Forward to the real webhook handler with the secret injected
  const secret = process.env.KAJABI_CE_WEBHOOK_SECRET
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

  const response = await fetch(`${baseUrl}/api/kajabi-ce-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-kajabi-token': secret,
    },
    body: JSON.stringify({
      member: { email, first_name: 'Test', last_name: 'Member' },
      tag,
    }),
  })

  const result = await response.json()
  return res.status(response.status).json(result)
}
