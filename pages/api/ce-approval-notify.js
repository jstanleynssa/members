// pages/api/ce-approval-notify.js
//
// Sends ONE digest email per member when their manual CE submissions are
// auto-approved. Called by the auto_approve_manual_ce() pg_cron function (via
// pg_net) AFTER it flips rows from 'pending' to 'approved'. Not a user-facing
// route — it's gated by a shared secret because the cron job calls it with no
// session, exactly like invite.js is gated for the Zap.
//
// House style matches ce-confirmation.js and invite.js: navy bar, #1C80BC links,
// sender "NSSA Member Portal <noreply@updates.nssapros.com>".
//
// Request body (from the cron function):
//   { submissions: [ { email, first_name, course_title, hours_earned,
//                      ce_type, designation, completion_date }, ... ] }
// Auth header:  x-notify-secret: <CE_NOTIFY_SECRET>

import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

const resend = new Resend(process.env.RESEND_API_KEY)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const PORTAL = 'https://members.nssapros.com'

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function hoursLabel(h) {
  const n = Number(h)
  return n === 1 ? '1 hour' : `${n} hours`
}

// "1 hour · Workshop · IRMAA" — drop the ce_type segment when blank/null.
function metaLine(s) {
  const parts = [hoursLabel(s.hours_earned)]
  const ceType = String(s.ce_type ?? '').trim()
  if (ceType) parts.push(escapeHtml(ceType))
  parts.push(escapeHtml(s.designation))
  return parts.join(' · ')
}

// Mirror of ce-confirmation.js totals logic, run AFTER approval so the progress
// line reflects the just-approved hours. Returns rendered lines for whichever
// designations the member is certified in.
async function progressLines(email, year) {
  const { data: member } = await supabase
    .from('members')
    .select('nssa_certified, irmaa_certified')
    .eq('email', email)
    .single()

  const { data: submissions } = await supabase
    .from('ce_submissions')
    .select('hours_earned, designation')
    .eq('email', email)
    .eq('year', year)
    .eq('status', 'approved')

  const rows = submissions || []
  const nssaHours = rows
    .filter(s => s.designation === 'NSSA' || s.designation === 'both')
    .reduce((sum, s) => sum + Number(s.hours_earned), 0)
  const irmaaHours = rows
    .filter(s => s.designation === 'IRMAA' || s.designation === 'both')
    .reduce((sum, s) => sum + Number(s.hours_earned), 0)

  const lines = []
  if (member?.nssa_certified) lines.push(`NSSA&reg;: ${nssaHours} of 4 hours completed`)
  if (member?.irmaa_certified) lines.push(`IRMAACP&trade;: ${irmaaHours} of 4 hours completed`)
  return lines
}

function buildHtml(firstName, rows, progress, year, daysLeft) {
  const name = escapeHtml(String(firstName ?? '').trim() || 'there')
  const single = rows.length === 1

  const intro = single
    ? 'Good news &mdash; the following CE submission has been reviewed and approved, and now counts toward your annual requirement:'
    : 'Good news &mdash; the following CE submissions have been reviewed and approved, and now count toward your annual requirement:'

  const rowHtml = rows.map(s => `
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 10px 0;">
                  <div style="font-weight: 500;">${escapeHtml(s.course_title)}</div>
                  <div style="color: #6b7280; font-size: 13px; margin-top: 2px;">${metaLine(s)}</div>
                </td>
              </tr>`).join('')

  const progressBlock = progress.length ? `
            <div style="background: #f9fafb; border-radius: 6px; padding: 1rem; margin: 1rem 0; font-size: 14px;">
              <p style="margin: 0 0 6px 0; font-weight: 600; color: #374151;">${year} CE Progress</p>
              ${progress.map(l => `<p style="margin: 0; color: #6b7280;">${l}</p>`).join('')}
              <p style="margin: 6px 0 0 0; color: #9ca3af; font-size: 12px;">${daysLeft} days remaining in ${year}</p>
            </div>` : ''

  return `
        <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 2rem;">
          <div style="background: #13405E; color: white; padding: 1rem 1.5rem; border-radius: 8px 8px 0 0;">
            <p style="margin: 0; font-weight: 700; font-size: 16px;">NSSA Member Portal</p>
          </div>
          <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; padding: 1.5rem;">
            <p>Hi ${name},</p>
            <p style="color: #374151; line-height: 1.6;">${intro}</p>
            <table style="width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 14px;">${rowHtml}
            </table>${progressBlock}
            <p style="font-size: 13px; color: #6b7280;">View your full CE history at <a href="${PORTAL}/dashboard" style="color: #1C80BC;">members.nssapros.com</a></p>
            <p>Thank you,<br>NSSA Team</p>
          </div>
        </div>`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Shared-secret guard — the cron job calls this with no session.
  const requiredSecret = process.env.CE_NOTIFY_SECRET
  if (requiredSecret) {
    const provided = req.headers['x-notify-secret'] || req.body?.secret
    if (provided !== requiredSecret) return res.status(401).json({ error: 'Unauthorized' })
  }

  const submissions = Array.isArray(req.body?.submissions) ? req.body.submissions : []
  if (submissions.length === 0) {
    return res.status(200).json({ sent: 0, message: 'nothing to send' })
  }

  // Group by email (case-insensitive — the CE table is email-keyed).
  const byMember = new Map()
  for (const s of submissions) {
    if (!s.email) continue
    const key = String(s.email).trim().toLowerCase()
    const arr = byMember.get(key) || []
    arr.push(s)
    byMember.set(key, arr)
  }

  const year = new Date().getFullYear()
  const daysLeft = Math.ceil((new Date(year, 11, 31) - new Date()) / (1000 * 60 * 60 * 24))

  const results = []
  for (const [email, rows] of byMember) {
    try {
      const progress = await progressLines(email, year)
      const subject = rows.length === 1
        ? 'Your CE submission has been approved'
        : `${rows.length} of your CE submissions have been approved`
      const html = buildHtml(rows[0].first_name, rows, progress, year, daysLeft)

      await resend.emails.send({
        from: 'NSSA Member Portal <noreply@updates.nssapros.com>',
        to: email,
        subject,
        html,
      })
      results.push({ email, ok: true })
    } catch (err) {
      console.error('[ce-approval-notify]', email, err.message)
      results.push({ email, ok: false, error: err.message })
    }
  }

  const sent = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok)
  return res.status(200).json({ members: byMember.size, sent, failed })
}
