import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // Auth gate
  const supabaseServer = createServerSupabaseClient({ req, res })
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session || session.user.email !== 'jstanley@nssapros.com') {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const { id } = req.body
  if (!id) return res.status(400).json({ error: 'Missing id' })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Update status
  const { data: partner, error } = await supabase
    .from('celp_partners')
    .update({ status: 'rejected' })
    .eq('id', id)
    .select('first_name, email')
    .single()

  if (error) {
    console.error('partner reject error:', error)
    return res.status(500).json({ error: error.message })
  }

  // Send polite rejection email
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)

    await resend.emails.send({
      from: 'CELP® Partner Network <engage@arpinstitute.com>',
      to: partner.email,
      subject: 'Your CELP® Partner Network application',
      html: `
<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:2rem;">
  <div style="background:#1a4a37;color:white;padding:1rem 1.5rem;border-radius:8px 8px 0 0;">
    <p style="margin:0;font-weight:700;font-size:16px;">CELP® Partner Network</p>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:1.5rem;">
    <p>Hi ${partner.first_name},</p>
    <p>Thank you for your interest in the CELP® Partner Network. After review, we're not able to add your listing at this time.</p>
    <p>If you think this is a mistake or have questions, please reply to this email and we'll take another look.</p>
    <p style="color:#6b7280;font-size:13px;">— The ARPI Team</p>
  </div>
</div>`,
    })
  } catch (emailErr) {
    console.error('Rejection email failed:', emailErr)
    // Don't fail — status is already saved
  }

  return res.status(200).json({ ok: true })
}
