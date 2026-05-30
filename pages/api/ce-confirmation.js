import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

const resend = new Resend(process.env.RESEND_API_KEY)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { email, firstName, courseTitle, hours, ceType, completionDate } = req.body

  // Get current year totals for this member
  const currentYear = new Date().getFullYear()
  const { data: member } = await supabase
    .from('members')
    .select('nssa_certified, irmaa_certified, nssa_cert_date, irmaa_cert_date')
    .eq('email', email)
    .single()

  const { data: submissions } = await supabase
    .from('ce_submissions')
    .select('hours_earned, designation')
    .eq('email', email)
    .eq('year', currentYear)
    .eq('status', 'approved')

  const nssaHours = (submissions || [])
    .filter(s => s.designation === 'NSSA' || s.designation === 'both')
    .reduce((sum, s) => sum + Number(s.hours_earned), 0)

  const irmaaHours = (submissions || [])
    .filter(s => s.designation === 'IRMAA' || s.designation === 'both')
    .reduce((sum, s) => sum + Number(s.hours_earned), 0)

  const nssaLine = member?.nssa_certified ? `NSSA®: ${nssaHours} of 4 hours completed` : null
  const irmaaLine = member?.irmaa_certified ? `IRMAACP™: ${irmaaHours} of 4 hours completed` : null
  const totalsText = [nssaLine, irmaaLine].filter(Boolean).join('\n')

  const daysLeft = Math.ceil((new Date(currentYear, 11, 31) - new Date()) / (1000 * 60 * 60 * 24))

  try {
    await resend.emails.send({
      from: 'NSSA Member Portal <noreply@updates.nssapros.com>',
      to: email,
      subject: `CE Submission Received — ${courseTitle}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 500px; margin: 0 auto; padding: 2rem;">
          <div style="background: #13405E; color: white; padding: 1rem 1.5rem; border-radius: 8px 8px 0 0;">
            <p style="margin: 0; font-weight: 700; font-size: 16px;">NSSA Member Portal</p>
          </div>
          <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; padding: 1.5rem;">
            <p>Hi ${firstName || 'there'},</p>
            <p>We've received your CE submission. Here are the details:</p>
            <table style="width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 14px;">
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 8px 0; color: #6b7280;">Course / Activity</td>
                <td style="padding: 8px 0; font-weight: 500;">${courseTitle}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 8px 0; color: #6b7280;">Completion Date</td>
                <td style="padding: 8px 0;">${new Date(completionDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 8px 0; color: #6b7280;">CE Type</td>
                <td style="padding: 8px 0;">${ceType}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Hours Earned</td>
                <td style="padding: 8px 0; font-weight: 500;">${hours}</td>
              </tr>
            </table>
            <div style="background: #f9fafb; border-radius: 6px; padding: 1rem; margin: 1rem 0; font-size: 14px;">
              <p style="margin: 0 0 6px 0; font-weight: 600; color: #374151;">${currentYear} CE Progress</p>
              ${[nssaLine, irmaaLine].filter(Boolean).map(l => `<p style="margin: 0; color: #6b7280;">${l}</p>`).join('')}
              <p style="margin: 6px 0 0 0; color: #9ca3af; font-size: 12px;">${daysLeft} days remaining in ${currentYear}</p>
            </div>
            <p style="font-size: 13px; color: #6b7280;">View your full CE history at <a href="https://members.nssapros.com/dashboard" style="color: #1C80BC;">members.nssapros.com</a></p>
            <p>Thank you,<br>NSSA Team</p>
          </div>
        </div>
      `
    })
    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('Resend error:', err)
    res.status(500).json({ error: err.message })
  }
}
