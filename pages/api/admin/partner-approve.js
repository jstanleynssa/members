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
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', id)
    .select('first_name, last_name, email, edit_token, role_label, city, state')
    .single()

  if (error) {
    console.error('partner approve error:', error)
    return res.status(500).json({ error: error.message })
  }

  // Send approval email with magic edit link
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const editUrl = `https://arpinstitute.com/partners/edit?token=${partner.edit_token}`

    await resend.emails.send({
      from: 'CELP® Partner Network <engage@arpinstitute.com>',
      to: partner.email,
      subject: "You're in — welcome to the CELP® Partner Network",
      html: `
<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:2rem;">
  <div style="background:#1a4a37;color:white;padding:1rem 1.5rem;border-radius:8px 8px 0 0;">
    <p style="margin:0;font-weight:700;font-size:16px;">CELP® Partner Network</p>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:1.5rem;">
    <p>Hi ${partner.first_name},</p>
    <p>Your application to the CELP® Partner Network has been approved. CELP®-certified professionals in your area can now find you and connect directly.</p>
    <p>Want to update your listing? Use the link below — no account required.</p>
    <p style="margin:1.5rem 0;">
      <a href="${editUrl}"
         style="background:#2a6b54;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
        Edit your listing →
      </a>
    </p>
    <p style="color:#6b7280;font-size:13px;">This link is unique to your account. Keep it safe — anyone with it can update your listing.</p>
    <p style="color:#6b7280;font-size:13px;">— The ARPI Team</p>
  </div>
</div>`,
    })
  } catch (emailErr) {
    console.error('Approval email failed:', emailErr)
    // Don't fail the response — approval is already saved
  }

  return res.status(200).json({ ok: true })
}
